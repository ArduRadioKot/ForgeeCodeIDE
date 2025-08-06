import customtkinter as ctk
import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter.ttk import Treeview
import os

class TextEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("Текстовый редактор")
        self.root.geometry("800x600")

        # Создание текстового редактора
        self.text_area = ctk.CTkTextbox(self.root, width=1600, height=500)
        self.text_area.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # Создание кнопок
        self.button_frame = ctk.CTkFrame(self.root)
        self.button_frame.pack(side=tk.BOTTOM, fill=tk.X)

        self.open_button = ctk.CTkButton(self.button_frame, text="Открыть", command=self.open_file)
        self.open_button.pack(side=tk.LEFT, fill=tk.X, expand=True)

        self.save_button = ctk.CTkButton(self.button_frame, text="Сохранить", command=self.save_file)
        self.save_button.pack(side=tk.LEFT, fill=tk.X, expand=True)

        # Создание древовидного меню
        self.tree = Treeview(self.root, columns=("Имя файла",), show="tree")
        self.tree.column("Имя файла", width=200)
        self.tree.heading("Имя файла", text="Имя файла")
        self.tree.pack(side=tk.LEFT, fill=tk.Y)

        # Add a root node for the project
        self.project_root = self.tree.insert("", tk.END, text="", open=True)
    def open_file(self):
        file_path = filedialog.askopenfilename(title="Открыть файл", filetypes=[("Текстовые файлы", "*.txt")])
        if file_path:
            with open(file_path, "r") as file:
                self.text_area.delete(1.0, tk.END)
                self.text_area.insert(tk.END, file.read())
            dir_path, file_name = os.path.split(file_path)
            dir_list = dir_path.split(os.sep)
            truncated_dir_path = os.sep.join(dir_list[-2:])  # truncate to last two directories
            self.add_file_to_tree(os.path.join(truncated_dir_path, file_name))

    def add_file_to_tree(self, file_path):
        # Get the directory and file name from the file path
        dir_path, file_name = os.path.split(file_path)

        # Find the parent node in the tree
        parent_node = self.find_node_by_path(dir_path)

        # Add the file node to the tree
        self.tree.insert(parent_node, tk.END, text=file_name)

    def find_node_by_path(self, dir_path):
        # Split the directory path into a list of directories
        dir_list = dir_path.split(os.sep)

        # Start at the project root node
        node = self.project_root

        # Iterate through the directory list and find the corresponding node in the tree
        for dir_name in dir_list[1:]:
            node = self.find_child_node(node, dir_name)

        return node

    def find_child_node(self, parent_node, child_name):
        # Iterate through the child nodes of the parent node
        for child_node in self.tree.get_children(parent_node):
            if self.tree.item(child_node, "text") == child_name:
                return child_node

        # If the child node is not found, create a new one
        return self.tree.insert(parent_node, tk.END, text=child_name, open=True)

    def save_file(self):
        # Open a dialog for choosing the save location
        initialdir = os.path.dirname(os.path.abspath(__file__))  # Set initial directory to the current file's directory
        file_path = filedialog.asksaveasfilename(title="Сохранить файл", defaultextension=".txt", filetypes=[("Текстовые файлы", "*.txt")], initialdir=initialdir)
        if file_path:
            with open(file_path, "w") as file:
                file.write(self.text_area.get(1.0, tk.END))
        # Update the tree view with the saved file
            dir_path, file_name = os.path.split(file_path)
            dir_list = dir_path.split(os.sep)
            truncated_dir_path = os.sep.join(dir_list[-2:])  # truncate to last two directories
            self.add_file_to_tree(os.path.join(truncated_dir_path, file_name))

if __name__ == "__main__":
    root = ctk.CTk()
    app = TextEditor(root)
    root.mainloop()