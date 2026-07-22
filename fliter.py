def filter_track_file(input_filename, output_filename, step=5):
    """
    每隔指定行数抽取一行数据并保存到新文件中
    :param input_filename: 输入的原始文件名
    :param output_filename: 过滤后的输出文件名
    :param step: 步长，每过 step 行取一行
    """
    try:
        with open(input_filename, 'r', encoding='utf-8') as fin, \
             open(output_filename, 'w', encoding='utf-8') as fout:
            
            count = 0
            for index, line in enumerate(fin):
                # index 从 0 开始，0, 5, 10, 15... 行会被保留
                if index % step == 0:
                    fout.write(line)
                    count += 1
                    
        print(f"处理完成！")
        print(f"原始文件: {input_filename}")
        print(f"新文件已保存至: {output_filename} (共保留了 {count} 行数据)")

    except FileNotFoundError:
        print(f"错误：未找到文件 '{input_filename}'，请检查路径是否正确。")
    except Exception as e:
        print(f"处理过程中发生错误: {e}")

if __name__ == "__main__":
    # 在这里配置你的文件名
    input_file = "track.txt"
    output_file = "track_subsampled.txt"
    
    filter_track_file(input_file, output_file, step=5)
