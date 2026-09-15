# Cam Player PnP camera driver

This directory contains the experimental AVStream backend for Cam Player. It is
derived from Microsoft's `avstream/avssamp` sample under the Microsoft Public
License included in this directory.

The existing DirectShow camera remains available. The PnP backend is a separate
Windows Camera-class device intended for Android emulators and applications
that do not enumerate legacy DirectShow-only capture filters.

## Development signing

GitHub Actions builds a test-signed driver package. Windows must allow test
drivers before this package can start. On machines with Secure Boot enabled,
Windows may reject a test-signed kernel driver even when test-signing mode is
enabled. Production distribution requires Microsoft attestation or WHQL
signing; replacing the test signature does not require changing the Player
frame protocol.

The packaged files are installed from the Player's **Virtual camera** tab. The
camera name is stored as the PnP device friendly name, while its hardware ID
remains stable so renaming does not create a new device.
