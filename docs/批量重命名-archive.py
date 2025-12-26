#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量重命名 archive 目录下的文档
根据文档第一行的标题（# 后面的内容）重命名文件
"""

import os
import re
from pathlib import Path

def sanitize_filename(title):
    """清理文件名，移除不允许的字符"""
    invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for char in invalid_chars:
        title = title.replace(char, '-')
    title = title.strip(' .')
    return title

def extract_title_from_file(file_path):
    """从文件第一行提取标题"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            first_line = f.readline().strip()
            match = re.match(r'^#\s+(.+)$', first_line)
            if match:
                return match.group(1)
    except Exception as e:
        print(f"读取文件 {file_path} 失败: {e}")
    return None

def extract_date_prefix(filename):
    """从文件名提取日期前缀（如 251212-）"""
    match = re.match(r'^(\d{6}-)', filename)
    if match:
        return match.group(1)
    return ''

def is_english_filename(filename):
    """判断文件名是否包含英文（需要重命名）"""
    if re.search(r'[\u4e00-\u9fff]', filename):
        return False
    return True

def rename_files_in_directory(directory):
    """批量重命名目录下的文件"""
    directory = Path(directory)
    renamed_count = 0
    skipped_count = 0
    error_count = 0
    
    print(f"开始处理目录: {directory}")
    print("=" * 60)
    
    # 获取所有 .md 文件（不包括子目录）
    md_files = list(directory.glob('*.md'))
    
    for file_path in md_files:
        filename = file_path.name
        
        # 跳过已经包含中文的文件名
        if not is_english_filename(filename):
            skipped_count += 1
            continue
        
        # 提取标题
        title = extract_title_from_file(file_path)
        if not title:
            print(f"⚠️  跳过 {filename}: 无法提取标题")
            skipped_count += 1
            continue
        
        # 清理标题作为文件名
        clean_title = sanitize_filename(title)
        
        # 提取日期前缀
        date_prefix = extract_date_prefix(filename)
        
        # 构建新文件名
        if date_prefix:
            new_filename = f"{date_prefix}{clean_title}.md"
        else:
            new_filename = f"{clean_title}.md"
        
        # 如果新文件名和旧文件名相同，跳过
        if new_filename == filename:
            print(f"✓  跳过 {filename}: 文件名已正确")
            skipped_count += 1
            continue
        
        # 检查新文件是否已存在
        new_file_path = file_path.parent / new_filename
        if new_file_path.exists():
            print(f"⚠️  跳过 {filename}: 目标文件已存在 ({new_filename})")
            skipped_count += 1
            continue
        
        # 重命名文件
        try:
            file_path.rename(new_file_path)
            print(f"✓  重命名: {filename}")
            print(f"   -> {new_filename}")
            renamed_count += 1
        except Exception as e:
            print(f"❌ 重命名失败 {filename}: {e}")
            error_count += 1
    
    print("=" * 60)
    print(f"处理完成:")
    print(f"  ✓ 成功重命名: {renamed_count} 个文件")
    print(f"  ⚠️  跳过: {skipped_count} 个文件")
    print(f"  ❌ 错误: {error_count} 个文件")

if __name__ == '__main__':
    script_dir = Path(__file__).parent
    archive_dir = script_dir / 'archive'
    
    if archive_dir.exists():
        print("处理 docs/archive 目录:")
        rename_files_in_directory(archive_dir)
        print()
    else:
        print(f"错误: archive 目录不存在: {archive_dir}")





