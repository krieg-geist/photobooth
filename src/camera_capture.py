import queue
import re
from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput
from libcamera import Transform
import board
import neopixel
import threading
import time
from PIL import Image
import io
import os
from contextlib import contextmanager
import evdev


from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

import requests

class UploadQueue:
    def __init__(self):
        self.drive_uploader = GoogleDriveUploader(
            credentials_path='/home/pi/photobooth/credentials.json',
            folder_id='1AJDAdtoWkDDbdk8jdlkitG1EofXRtGen'
        )
        self.queue = queue.Queue()
        self.is_running = True
        self.upload_thread = threading.Thread(target=self._process_queue, daemon=True)
        self.upload_thread.start()
    
    def add_to_queue(self, filename):
        """Add a file to the upload queue"""
        self.queue.put(filename)
    
    def _process_queue(self):
        """Process the upload queue in the background"""
        while self.is_running:
            try:
                # Get filename from queue, wait up to 1 second
                filename = self.queue.get(timeout=1.0)
                
                try:
                    # Upload to Google Drive
                    file = self.drive_uploader.upload_file(filename)
                    print(f"Uploaded {file['name']} to Google Drive")
                    print(f"View at: {file['webViewLink']}")
                except Exception as e:
                    print(f"Failed to upload {filename} to Google Drive: {str(e)}")
                
                # Mark task as done
                self.queue.task_done()
                
            except queue.Empty:
                # No items in queue, continue waiting
                continue
            except Exception as e:
                print(f"Error in upload queue processor: {str(e)}")
                time.sleep(1)  # Prevent tight loop on repeated errors
    
    def stop(self):
        """Stop the upload queue processor"""
        self.is_running = False
        self.upload_thread.join()

class GoogleDriveUploader:
    def __init__(self, credentials_path='credentials.json', folder_id=None):
        """
        Initialize Google Drive uploader with service account credentials.
        
        Args:
            service_account_path (str): Path to the service account JSON file
            folder_id (str): Optional Google Drive folder ID to upload to
        """
        self.SCOPES = ['https://www.googleapis.com/auth/drive.file']
        self.service_account_path = credentials_path
        self.folder_id = folder_id
        self.service = None
        
    def authenticate(self):
        """Authenticate with Google Drive API using service account."""
        credentials = service_account.Credentials.from_service_account_file(
            self.service_account_path,
            scopes=self.SCOPES
        )
        
        self.service = build('drive', 'v3', credentials=credentials)
        
    def create_folder(self, folder_name):
        """
        Create a new folder in Google Drive.
        
        Args:
            folder_name (str): Name of the folder to create
            
        Returns:
            str: ID of the created folder
        """
        if not self.service:
            self.authenticate()
            
        folder_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        
        folder = self.service.files().create(
            body=folder_metadata,
            fields='id'
        ).execute()
        
        return folder.get('id')
    
    def upload_file(self, file_path, folder_id=None):
        """
        Upload a file to Google Drive.
        
        Args:
            file_path (str): Path to the file to upload
            folder_id (str): Optional folder ID to upload to (overrides instance folder_id)
            
        Returns:
            dict: File metadata from Google Drive
        """
        if not self.service:
            self.authenticate()
            
        target_folder = folder_id or self.folder_id
        file_name = os.path.basename(file_path)
        
        file_metadata = {
            'name': file_name
        }
        
        if target_folder:
            file_metadata['parents'] = [target_folder]
        
        # Detect mimetype based on file extension
        file_ext = os.path.splitext(file_path)[1].lower()
        mime_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
        }
        mime_type = mime_types.get(file_ext, 'application/octet-stream')
        
        media = MediaFileUpload(
            file_path,
            mimetype=mime_type,
            resumable=True
        )
        
        file = self.service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, name, webViewLink'
        ).execute()
        
        return file

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()

class PixelAnimator:
    def __init__(self, num_pixels):
        self.pixels = neopixel.NeoPixel(board.D18, num_pixels, auto_write=False)
        self.num_pixels = num_pixels
        self.animation_thread = None
        self.stop_event = threading.Event()

    @contextmanager
    def animation_context(self):
        try:
            yield
        finally:
            self.pixels.fill((0, 0, 0))
            self.pixels.show()

    def start_animation(self, animation_type, duration=1, blocking=False, **kwargs):
        if self.animation_thread and self.animation_thread.is_alive():
            self.stop_event.set()
            self.animation_thread.join()

        self.stop_event.clear()
        if animation_type == 'countdown':
            target = self._countdown_animation
        elif animation_type == 'pulse':
            target = self._pulse_animation
        elif animation_type == 'flash':
            target = self._flash_animation
        else:
            raise ValueError(f"Unknown animation type: {animation_type}")

        if blocking:
            with self.animation_context():
                target(duration, **kwargs)
        else:
            self.animation_thread = threading.Thread(target=self._run_animation_with_context, args=(target, duration), kwargs=kwargs)
            self.animation_thread.start()

    def _run_animation_with_context(self, animation_func, duration, **kwargs):
        with self.animation_context():
            animation_func(duration, **kwargs)

    def _countdown_animation(self, duration):
        colors = [(255, 0, 0), (255, 255, 0), (0, 255, 0)]  # Red, Yellow, Green
        for color in colors:
            start_time = time.time()
            while time.time() - start_time < 1 and not self.stop_event.is_set():
                for i in range(self.num_pixels):
                    self.pixels.fill((0, 0, 0))
                    self.pixels[i] = color
                    if i > 0:
                        self.pixels[i-1] = tuple(int(0.3 * c) for c in color)
                    self.pixels.show()
                    time.sleep(1 / self.num_pixels)

    def _flash_animation(self, duration):
        self.pixels.fill((255, 255, 255))
        self.pixels.show()
        time.sleep(0.3)
        self.pixels.fill((0, 0, 0))
        self.pixels.show()

    def _pulse_animation(self, duration, color=(0, 255, 0)):
        start_time = time.time()
        while time.time() - start_time < duration and not self.stop_event.is_set():
            for i in range(0, 255, 5):
                if self.stop_event.is_set():
                    break
                self.pixels.fill(tuple(int(i/255 * c) for c in color))
                self.pixels.show()
                time.sleep(0.01)
            for i in range(255, 0, -5):
                if self.stop_event.is_set():
                    break
                self.pixels.fill(tuple(int(i/255 * c) for c in color))
                self.pixels.show()
                time.sleep(0.01)

    def stop_animation(self):
        self.stop_event.set()
        if self.animation_thread and self.animation_thread.is_alive():
            self.animation_thread.join()

    def __del__(self):
        self.stop_animation()
        self.pixels.fill((0, 0, 0))
        self.pixels.show()


class CameraCaptureSystem:
    def __init__(self, num_pixels=16, capture_dir="/home/pi/photobooth/captures"):
        self.pixel_animator = PixelAnimator(num_pixels)
        self.capture_dir = capture_dir
        self.capture_lock = threading.Lock()
        os.makedirs(self.capture_dir, exist_ok=True)
        self.capture_count = self._get_last_photo_number() + 1
        self.streaming = False
        self.prepared_watermark = None
        self.upload_queue = UploadQueue()
        self._setup_watermark()
        self.setup_camera()

    def __del__(self):
        self.stop_mjpeg_stream()
        if hasattr(self, 'picam2'):
            self.picam2.stop()

    def _setup_watermark(self):
        """Prepare the watermark image once during initialization."""
        with Image.open('./static/img/watermark.png') as watermark:
            # Convert watermark to RGBA if it isn't already
            watermark = watermark.convert('RGBA')
            
            # Fixed dimensions for the watermark
            target_width = 1080
            target_height = 146
            
            # Resize watermark to exact dimensions needed
            watermark = watermark.resize((target_width, target_height), Image.Resampling.LANCZOS)
            
            # Create transparent version with 50% transparency
            transparent_watermark = Image.new('RGBA', watermark.size, (0, 0, 0, 0))
            for x in range(target_width):
                for y in range(target_height):
                    pixel = watermark.getpixel((x, y))
                    transparent_watermark.putpixel(
                        (x, y),
                        (pixel[0], pixel[1], pixel[2], int(pixel[3] * 0.70))
                    )
            
            # Store the prepared watermark and its position
            self.prepared_watermark = transparent_watermark
            self.watermark_position = (
                0,  # Left aligned
                1350 - target_height - 100  # Bottom with 50px offset
            )


    def setup_camera(self):
        self.picam2 = Picamera2()
        # Create video configuration for streaming
        camera_config = self.picam2.create_video_configuration(
            transform=Transform(vflip=False),
            main={"size": (1080, 1350)},
            encode="main"
        )
        self.picam2.configure(camera_config)
        self.picam2.set_controls({"FrameRate": 15})
        self.picam2.start()

        # Set up MJPEG encoder and output
        self.output = StreamingOutput()
        self.encoder = JpegEncoder(q=80)  # Set quality in constructor
        self.file_output = FileOutput(self.output)

    def mjpeg_generator(self):
        try:
            if not self.streaming:
                self.start_mjpeg_stream()
            
            while True:
                with self.output.condition:
                    self.output.condition.wait()
                    frame = self.output.frame
                if frame:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                else:
                    print("Empty frame received")
                time.sleep(0.033)
        except Exception as e:
            print(f"Error in MJPEG generator: {str(e)}")


    def start_mjpeg_stream(self):
        if not self.streaming:
            self.streaming = True
            # Start recording without specifying quality here
            self.picam2.start_recording(self.encoder, self.file_output)

    def stop_mjpeg_stream(self):
        if self.streaming:
            self.streaming = False
            try:
                self.picam2.stop_recording()
            except Exception as e:
                print(f"Error stopping recording: {str(e)}")


    def _get_last_photo_number(self):
        photo_numbers = []
        for filename in os.listdir(self.capture_dir):
            match = re.match(r'photo_(\d+)\.jpg', filename)
            if match:
                photo_numbers.append(int(match.group(1)))
        return max(photo_numbers) if photo_numbers else -1  # Return -1 if no photos found

    def _capture_single_image(self):
        """Helper method to capture a single image with flash"""
        self.capture_count += 1
        filename = os.path.join(self.capture_dir, f"photo_{self.capture_count}.jpg")
        stream = io.BytesIO()
        if not self.streaming:
            self.start_mjpeg_stream()
        # Flash and capture
        self.pixel_animator.start_animation('flash')
        time.sleep(0.1)
        self.picam2.capture_file(stream, format='jpeg')
        
        stream.seek(0)
        
        # Process image with watermark
        with Image.open(stream) as img:
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            img.paste(self.prepared_watermark, self.watermark_position, self.prepared_watermark)
            img = img.convert('RGB')
            img.save(filename)
        
        print(f"Image captured: {filename}")
        self.stop_mjpeg_stream()
        return filename

    def capture_image(self):
        """Capture a single image with countdown"""
        with self.capture_lock:
            self.pixel_animator.start_animation('countdown', 3, blocking=True)
            filename = self._capture_single_image()
            self.upload(filename)
            return filename

    def capture_image_3(self):
        """Capture three images with exactly 1 second between each"""
        with self.capture_lock:
            filenames = []
            
            # Initial countdown
            self.pixel_animator.start_animation('countdown', 3, blocking=True)
            
            # Get start time
            start_time = time.time()
            
            # Capture 3 images at absolute times
            for i in range(3):
                # Calculate target time for this capture
                target_time = start_time + i
                
                # Wait until we reach the target time
                wait_time = target_time - time.time()
                if wait_time > 0:
                    time.sleep(wait_time)
                
                filename = self._capture_single_image()
                filenames.append(filename)
            
            # Increment counter and queue uploads
            self.capture_count += 1
            for filename in filenames:
                self.upload_queue.add_to_queue(filename)

            if not self.streaming:
                self.start_mjpeg_stream()
            
            return filenames
        
    def upload(self, filename):
        """Capture an image and upload it to Google Drive."""
        # Capture the image
        
        self.upload_queue.add_to_queue(filename)


    def get_latest_photo(self):
        photos = self.get_all_photos()
        return photos[0] if photos else None

    def get_all_photos(self):
        return sorted(
            [f for f in os.listdir(self.capture_dir) if f.startswith('photo_') and f.endswith('.jpg')],
            key=lambda x: int(x.split('_')[1].split('.')[0]),
            reverse=True
        )

    def run(self):
        self.pixel_animator.start_animation('pulse', 3, blocking=True, color=(0, 255, 0))
        print("Camera system ready.")

    def cleanup(self):
        self.keep_running = False
        if self.gamepad_device:
            self.gamepad_device.close()
        self.stop_mjpeg_stream()
        self.picam2.stop()
        self.pixel_animator.stop_animation()
        self.upload_queue.stop()
