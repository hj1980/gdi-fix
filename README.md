gdi-fix
=======

Fix up Google Drive's snapshot.db to reflect new inodes. Useful if copying to a new drive, for example.

The motivation behind this was to resolve the "not your original Google Drive" error. This error is detected when the inodes no longer match, as is the case when the folder is copied to another drive - in my case, upgrading to a new SSD.


