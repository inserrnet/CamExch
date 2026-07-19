# Debug signing

`camexch-debug.p12` gives Source and Browser a stable identity across GitHub
Actions runs, so debug APK updates and inter-app IPC keep working.

This public development key must never be used to sign a production release.
Production builds require a private key supplied through GitHub secrets.
