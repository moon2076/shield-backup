Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """ -Silent", 0, False
