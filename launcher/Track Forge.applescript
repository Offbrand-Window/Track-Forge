set appPath to POSIX path of (path to me)
set launcherPath to appPath & "Contents/Resources/app/bin/track-forge.command"
do shell script quoted form of launcherPath
