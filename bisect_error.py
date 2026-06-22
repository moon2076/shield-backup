# -*- coding: utf-8 -*-
import subprocess

def run_build():
    cmd = "docker run --rm -v /opt/stacks/backup-agent/server:/app -w /app golang:alpine go build test_main.go"
    proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = proc.communicate()
    return stderr.decode('utf-8', errors='ignore')

def main():
    # 循环注释报错行，找出到底有多少行在报错
    # 并且打印出它们的上下文
    with open('/opt/stacks/backup-agent/server/test_main.go', 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    print("Initial build attempt:")
    err = run_build()
    print(err)
    
    # 解析报错的行号
    # 例如：./test_main.go:1987:1: syntax error...
    import re
    
    for attempt in range(5):
        match = re.search(r'test_main\.go:(\d+):', err)
        if not match:
            print("No more line-specific syntax errors found.")
            break
            
        err_line = int(match.group(1))
        print(f"\n[Attempt {attempt+1}] Error at line {err_line}:")
        
        # 打印这一行及周围
        start = max(0, err_line - 3)
        end = min(len(lines), err_line + 2)
        for idx in range(start, end):
            prefix = "--> " if idx + 1 == err_line else "    "
            print(f"{prefix}Line {idx+1}: {lines[idx]}", end='')
            
        # 注释掉这一行
        lines[err_line - 1] = "// COMMENTED BY BISECT: " + lines[err_line - 1]
        
        # 写回文件并重新编译
        with open('/opt/stacks/backup-agent/server/test_main.go', 'w', encoding='utf-8') as f:
            f.writelines(lines)
            
        err = run_build()
        print("\nNew compiler output:")
        print(err)

if __name__ == '__main__':
    main()
