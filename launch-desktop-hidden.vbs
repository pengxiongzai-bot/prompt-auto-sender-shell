Set shell = CreateObject("WScript.Shell")
scriptPath = WScript.ScriptFullName
appDir = Left(scriptPath, InStrRev(scriptPath, "\"))
shell.CurrentDirectory = appDir
cmd = "cmd.exe /d /c cd /d """ & appDir & """ && npm.cmd run desktop"
shell.Run cmd, 0, False
