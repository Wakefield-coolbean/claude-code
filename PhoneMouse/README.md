# PhoneMouse

Turn an iPhone into a mouse. The back camera watches the surface under the phone and works out
which way you are sliding it, the same way an optical mouse does. The screen is laid out like the
top of a mouse: left and right keys, a scroll wheel on the seam, and a sensor read-out in the palm.

## What's here

| Path | What it is |
| --- | --- |
| `PhoneMouse.xcodeproj`, `PhoneMouse/` | The iOS app (SwiftUI, iOS 17+) |
| `server/phonemouse_server.py` | The receiver you run on the computer you want to control |
| `Tests/`, `Package.swift` | Unit tests for the motion sensor (`swift test`) |
| `../.github/workflows/phonemouse-ipa.yml` | Builds an unsigned `.ipa` on every push |

## 1. Run the receiver on your computer

iOS does not let an app act as a Bluetooth mouse, so the phone talks to a small receiver over
Wi-Fi. It works on Windows, macOS and Linux (X11).

```bash
pip install pynput zeroconf
```

```bash
python3 phonemouse_server.py
```

It prints the computer's address and a 6-digit PIN. On macOS, allow your terminal under
System Settings → Privacy & Security → Accessibility so it may move the pointer.

## 2. Install the app

**With a Mac:** open `PhoneMouse.xcodeproj`, pick your team under Signing & Capabilities, and run
it on your iPhone.

**Without a Mac:** download `PhoneMouse-unsigned.ipa` from the latest *PhoneMouse IPA* run under
the repository's Actions tab and install it with a sideloading tool such as AltStore or Sideloadly,
which signs it with your Apple ID.

## 3. Use it

1. Open the app with the phone on the same Wi-Fi as the computer. Pick the computer and type the
   PIN (once).
2. Slide the phone like a mouse. Press the top halves of the screen for left and right click
   (hold to drag), drag the wheel to scroll, tap the wheel for middle click.
3. The ring in the palm shows how well the camera can see the surface. Tap it to pause tracking
   while you reposition the phone. The **SPEED** switch cycles pointer speed.

### Getting good tracking

- The camera needs to see texture. Wood, fabric, paper with print and mouse pads work; glass and
  plain glossy white do not.
- With the phone flat on the desk the lens is only millimetres from the surface, so the view is
  small and blurred. A case that lifts the phone, or hovering it a few centimetres up, gives a much
  larger and sharper view and tracks faster movements.
- The light on the back illuminates the surface. Turn it off (flashlight button) if you hold the
  phone up and point it at the room instead.
- If the pointer moves the opposite way to the phone, flip the matching switch in Settings.

## How it works

Each camera frame (up to 120 fps) is reduced to a 64×64 brightness grid. The sensor keeps a
reference frame and searches ±16 px for where its centre reappears, refines the match to a
fraction of a pixel, and reports the change. Matching against a held reference means slow movement
adds up instead of being rounded away. A motion prior keeps it from jumping between look-alike
matches on repeating patterns, and on striped surfaces it only reports the direction it can
actually observe. The result passes through a 1€ filter and an acceleration curve and is sent to
the receiver as relative pointer moves.

The link is plain TCP on port 47800 with newline-delimited text commands. Pairing proves knowledge
of the PIN with an HMAC challenge, so the PIN itself is never sent. Pointer traffic is not
encrypted, so use it on a network you trust.
