import os
from flask import Flask, Response, render_template, send_from_directory, request, jsonify
from src.camera_capture import CameraCaptureSystem
import threading
import time
import json

# Get the absolute path of the current directory
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
CAPTURES_DIR = os.path.join(BASE_DIR, 'captures')

app = Flask(__name__, template_folder='templates')
camera_system = None


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
    camera_system = CameraCaptureSystem(capture_dir=CAPTURES_DIR)
    camera_system.run()

if __name__ == '__main__':
    # Ensure the captures directory exists
    os.makedirs(CAPTURES_DIR, exist_ok=True)

    camera_thread = threading.Thread(target=initialize_camera_system)
    camera_thread.daemon = True  # This allows the thread to be terminated when the main program exits
    camera_thread.start()
    time.sleep(2)  # Give the camera system time to initialize

    app.run(host='0.0.0.0', port=80, debug=True, use_reloader=False)