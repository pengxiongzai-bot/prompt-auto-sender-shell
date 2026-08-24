Set shell = CreateObject("WScript.Shell")
scriptPath = WScript.ScriptFullName
appDir = Left(scriptPath, InStrRev(scriptPath, "\"))
shell.Run """" & appDir & "start-workbench.bat" & """", 0, False
