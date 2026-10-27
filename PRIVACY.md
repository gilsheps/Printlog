# PrintLog – Privacy Policy

_Last updated: October 27, 2026_

PrintLog is a desktop app (macOS / Windows) for keeping a library of 3D-print files (STL / 3MF) and a log of prints from Bambu Lab printers.

## What PrintLog accesses

- **Your models folder** – the folder you choose. PrintLog reads the files to show previews and stores its own data (tags, notes, print log, thumbnails) in a hidden `.shelf` folder inside it.
- **Your Bambu Lab account (optional)** – if you sign in, PrintLog reads your printers and print history from Bambu Lab. Your password is never stored; only the access token Bambu returns, encrypted with your operating system's keychain.
- **Your Google Drive (optional)** – if you connect Google Drive, PrintLog uses the `drive.file` permission, which only gives it access to files **it created itself**. It creates a folder named "PrintLog Archive", uploads files you choose to archive, and downloads them again when you open or restore them. It cannot see or change any other file in your Drive.

## What PrintLog does not do

- It has no servers of its own. Nothing is sent to the developer.
- It does not collect analytics, sell, share or transfer any data.
- Data from Google APIs is used only to provide the archive feature described above, in line with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Removing access

- Google Drive: Settings → "התנתק" in PrintLog, or remove PrintLog at <https://myaccount.google.com/permissions>.
- Bambu Lab: Settings → "התנתק" in PrintLog.
- Uninstalling PrintLog removes its settings. Your models folder and archived files stay yours.

## Contact

Gil Sheps – gil.sheps@gmail.com
