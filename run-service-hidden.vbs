Set shell = CreateObject("WScript.Shell")
scriptPath = WScript.ScriptFullName
appDir = Left(scriptPath, InStrRev(scriptPath, "\"))
shell.Run """" & appDir & "run-service.bat" & """", 0, False
