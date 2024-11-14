import evdev
from evdev import InputDevice, categorize, ecodes
import sys
import time

def get_gamepad_info(device):
    """Get detailed information about a gamepad device."""
    info = {
        "Name": device.name,
        "Path": device.path,
        "Physical Address": device.phys,
        "Unique ID": device.uniq,
        "Input ID": {
            "Bus Type": device.info.bustype,
            "Vendor ID": hex(device.info.vendor),
            "Product ID": hex(device.info.product),
            "Version": device.info.version
        },
        "Capabilities": {}
    }
    
    return info

def find_gamepads():
    """Find all connected gamepad devices."""
    devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
    gamepads = []
    
    for device in devices:
        # Check if device has typical gamepad capabilities
        caps = device.capabilities()
        
        # Common gamepad characteristics
        has_abs_axes = ecodes.EV_ABS in caps  # Analog sticks/triggers
        has_buttons = ecodes.EV_KEY in caps   # Buttons
        
        # If device has both analog inputs and buttons, it's likely a gamepad
        if has_abs_axes and has_buttons:
            gamepads.append(device)
            
    return gamepads

def print_gamepad_info(gamepad):
    """Print formatted gamepad information."""
    info = get_gamepad_info(gamepad)
    
    print("\n" + "="*50)
    print(f"Gamepad: {info['Name']}")
    print("="*50)
    print(f"Device Path: {info['Path']}")
    print(f"Physical Address: {info['Physical Address']}")
    print(f"Unique ID: {info['Unique ID']}")
    
    print("\nInput Device Info:")
    print(f"  Bus Type: {info['Input ID']['Bus Type']}")
    print(f"  Vendor ID: {info['Input ID']['Vendor ID']}")
    print(f"  Product ID: {info['Input ID']['Product ID']}")
    print(f"  Version: {info['Input ID']['Version']}")
    
    print("\nCapabilities:")
    for event_type, codes in info['Capabilities'].items():
        print(f"\n  {event_type}:")
        if isinstance(codes, list):
            for code in codes:
                if isinstance(code, dict):
                    print(f"    {code['name']}:")
                    for key, value in code['info'].items():
                        print(f"      {key}: {value}")
                else:
                    print(f"    {code}")
        else:
            print(f"    {codes}")

def monitor_gamepad(gamepad):
    """Monitor and print real-time gamepad events."""
    print(f"\nMonitoring events for {gamepad.name}")
    print("Press Ctrl+C to stop monitoring")
    
    try:
        for event in gamepad.read_loop():
            if event.type == ecodes.EV_KEY:
                key_event = categorize(event)
                print(f"Button: {key_event.keycode}, State: {'pressed' if event.value else 'released'}")
            elif event.type == ecodes.EV_ABS:
                absevent = categorize(event)
                print(f"Axis: {absevent.event.code}, Value: {event.value}")
    except KeyboardInterrupt:
        print("\nStopped monitoring")

def main():
    try:
        print("Searching for gamepads...")
        gamepads = find_gamepads()
        
        if not gamepads:
            print("No gamepads found!")
            return
        
        print(f"\nFound {len(gamepads)} gamepad(s):")
        for i, gamepad in enumerate(gamepads, 1):
            print(f"{i}. {gamepad.name}")
        
        # Print detailed info for each gamepad
        for gamepad in gamepads:
            print_gamepad_info(gamepad)
        
        # If there are gamepads, offer to monitor one
        if len(gamepads) > 0:
            choice = input("\nWould you like to monitor gamepad events? (y/n): ")
            if choice.lower() == 'y':
                if len(gamepads) > 1:
                    gamepad_num = int(input(f"Which gamepad? (1-{len(gamepads)}): ")) - 1
                    monitor_gamepad(gamepads[gamepad_num])
                else:
                    monitor_gamepad(gamepads[0])
                    
    except PermissionError:
        print("\nError: Permission denied. Try running the script with sudo:")
        print("sudo python3 gamepad_detector.py")
    except Exception as e:
        print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    main()