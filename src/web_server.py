from flask import Flask, render_template, send_from_directory
import os

class WebServer:
    def __init__(self, capture_dir):
        self.app = Flask(__name__, static_folder='static')
        self.capture_dir = capture_dir

        @self.app.route('/')
        def index():
            photos = sorted([f for f in os.listdir(self.capture_dir) if f.endswith('.jpg')], reverse=True)
            return render_template('index.html', photos=photos)

        @self.app.route('/captures/<path:filename>')
        def serve_photo(filename):
            return send_from_directory(self.capture_dir, filename)

    def run(self, port):
        self.app.run(host='0.0.0.0', port=port, debug=True)
