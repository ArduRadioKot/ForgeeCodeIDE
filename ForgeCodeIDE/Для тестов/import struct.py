import tkinter as tk
from tkinter import filedialog

class TextEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("Text Editor Application")
        self.text_area = tk.Text(self.root, width=100, height=40)
        self.text_area.pack(side=tk.RIGHT, fill=tk.BOTH, expand=1)
        self.line_number_area = tk.Text(self.root, width=5, height=40)
        self.line_number_area.pack(side=tk.LEFT, fill=tk.Y)
        self.update_line_numbers()
        self.menu = tk.Menu(self.root)
        self.root.config(menu=self.menu)
        self.file_menu = tk.Menu(self.menu)
        self.menu.add_cascade(label="File", menu=self.file_menu)
        self.file_menu.add_command(label="Open", command=self.open_file)
        self.file_menu.add_command(label="Save As...", command=self.save_file) 

    def update_line_numbers(self):
        self.line_number_area.delete(1.0, tk.END)
        for i, line in enumerate(self.text_area.get("1.0", tk.END).split("\n"), start=1):
            self.line_number_area.insert(tk.END, f"{i}\n")
        self.root.after(100, self.update_line_numbers)

    def open_file(self):
        filepath = filedialog.askopenfilename(filetypes=[("Text Files", "*.txt"), ("All Files", "*.*")])
        if not filepath:
            return
        self.text_area.delete(1.0, tk.END)
        with open(filepath, "r") as input_file:
            text = input_file.read()
            self.text_area.insert(tk.END, text)
        self.root.title(f"Text Editor Application - {filepath}")

    def save_file(self):
        filepath = filedialog.asksaveasfilename(filetypes=[("Text Files", "*.txt"), ("All Files", "*.*")])
        if not filepath:
            return
        with open(filepath, "w") as output_file:
            text = self.text_area.get(1.0, tk.END)
            output_file.write(text)
        self.root.title(f"Text Editor Application - {filepath}")

root = tk.Tk()
editor = TextEditor(root)
root.mainloop()