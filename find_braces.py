# -*- coding: utf-8 -*-

def main():
    filepath = r"d:\Work_Project\VPS_RN\backup-agent\server\main.go"
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    in_string = False
    in_raw_string = False
    escape = False
    in_char = False
    in_line_comment = False
    in_block_comment = False
    
    line_num = 1
    col_num = 0
    
    level = 0
    current_func_name = None
    func_start_line = 0
    
    i = 0
    while i < len(content):
        c = content[i]
        col_num += 1
        
        if c == '\n':
            line_num += 1
            col_num = 0
            if in_line_comment:
                in_line_comment = False
                i += 1
                continue
        
        if in_line_comment:
            i += 1
            continue
            
        if in_block_comment:
            if c == '*' and i + 1 < len(content) and content[i+1] == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
            
        if escape:
            escape = False
            i += 1
            continue
            
        if c == '\\' and not in_raw_string:
            escape = True
            i += 1
            continue
            
        if in_string:
            if c == '"':
                in_string = False
            i += 1
            continue

        if in_raw_string:
            if c == '`':
                in_raw_string = False
            i += 1
            continue
            
        if in_char:
            if c == "'":
                in_char = False
            i += 1
            continue
            
        if c == '/' and i + 1 < len(content) and content[i+1] == '/':
            in_line_comment = True
            i += 2
            continue
            
        if c == '/' and i + 1 < len(content) and content[i+1] == '*':
            in_block_comment = True
            i += 2
            continue
            
        if c == '"':
            in_string = True
            i += 1
            continue

        if c == '`':
            in_raw_string = True
            i += 1
            continue
            
        if c == "'":
            in_char = True
            i += 1
            continue
            
        if level == 0 and content[i:i+5] == 'func ':
            end_idx = content.find('(', i+5)
            if end_idx != -1:
                func_decl = content[i+5:end_idx].strip()
                if func_decl.startswith('('):
                    close_idx = func_decl.find(')')
                    if close_idx != -1:
                        func_decl = func_decl[close_idx+1:].strip()
                current_func_name = func_decl.split(' ')[0].split('\n')[0]
                func_start_line = line_num
                
        if c == '{':
            level += 1
        elif c == '}':
            level -= 1
            # 在函数内部，如果在结束之前 level 降到了 0 或者是负数，报错！
            if current_func_name and level <= 0:
                # 检查后面是不是紧跟着下一个函数的定义或者文件结束，如果不是，说明是提前闭合
                # 我们先打印出来分析
                print(f"WARNING: Func '{current_func_name}' (started L{func_start_line}) level dropped to {level} at L{line_num} C{col_num}")
                
            if level == 0 and current_func_name:
                current_func_name = None
        
        i += 1

if __name__ == '__main__':
    main()
