Set WshShell = CreateObject("WScript.Shell")
' 以隐藏窗口状态(0)调用PowerShell脚本，且不等待其返回直接退出，从而100%不霸占前台焦点
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """ -Silent", 0, False
