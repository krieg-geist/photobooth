import os
import atexit
from flask import Flask, Response, render_template, send_from_directory, request, jsonify
from src.camera_capture import CameraCaptureSystem
import threading
import time
import json
import signal
import sys

# Get the absolute path of the current directory
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
CAPTURES_DIR = os.path.join(BASE_DIR, 'captures')

app = Flask(__name__, template_folder='templates')
camera_system = None
camera_lock = threading.Lock()
shutdown_event = threading.Event()

def cleanup_resources():
    """Cleanup function to properly shut down camera and threads"""
    global camera_system
    with camera_lock:
        if camera_system:
            print("Shutting down camera system...")
            camera_system.stop_mjpeg_stream()
            camera_system.cleanup()
            camera_system = None
    print("Cleanup complete")

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    print(f"Received signal {signum}")
    cleanup_resources()
    sys.exit(0)

@app.route('/')
def index():
    photos = camera_system.get_all_photos() if camera_system else []
    return render_template('index.html', photos=photos)

@app.route('/video_feed')
def video_feed():
    return Response(camera_system.mjpeg_generator(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/capture', methods=['POST'])
def capture():
    if camera_system:
        filename = camera_system.capture_image()
        return jsonify({'status': 'success', 'filename': os.path.basename(filename)})
    return jsonify({'status': 'error', 'message': 'Camera system not initialized'}), 500

@app.route('/capture_3', methods=['POST'])
def capture_3():
    if camera_system:
        filenames = camera_system.capture_image_3()
        return jsonify({
            'status': 'success', 
            'filenames': [os.path.basename(f) for f in filenames]
        })
    return jsonify({'status': 'error', 'message': 'Camera system not initialized'}), 500

@app.route('/captures/<path:filename>')
def serve_photo(filename):
    return send_from_directory(CAPTURES_DIR, filename)



def initialize_camera_system():
    global camera_system
    retry_count = 0
    max_retries = 3
    
    while retry_count < max_retries and not shutdown_event.is_set():
        try:
            with camera_lock:
                if not camera_system:
                    print("Initializing camera system...")
                    camera_system = CameraCaptureSystem(capture_dir=CAPTURES_DIR)
                    camera_system.run()
                    print("Camera system initialized successfully")
                    return True
        except Exception as e:
            print(f"Error initializing camera (attempt {retry_count + 1}/{max_retries}): {e}")
            retry_count += 1
            time.sleep(2)
    
    return False

def start_camera_thread():
    camera_thread = threading.Thread(target=initialize_camera_system)
    camera_thread.daemon = True
    camera_thread.start()
    return camera_thread

if __name__ == '__main__':
    # Ensure the captures directory exists
    os.makedirs(CAPTURES_DIR, exist_ok=True)

    # Set up signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Register cleanup function
    atexit.register(cleanup_resources)

    # Start camera initialization
    camera_thread = start_camera_thread()
    time.sleep(2)  # Give the camera system time to initialize

    try:
        app.run(host='0.0.0.0', port=80, debug=True, use_reloader=False)
    except Exception as e:
        print(f"Error running Flask app: {e}")
    finally:
        shutdown_event.set()
        cleanup_resources()