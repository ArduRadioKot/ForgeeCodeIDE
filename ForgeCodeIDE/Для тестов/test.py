import tkinter as tk
import tkinter.ttk as ttk
import os
from tkinter import filedialog, simpledialog

class IDE:
    def __init__(self, root):
        self.root = root
        self.root.title("Simple IDE")
        self.root.geometry("800x600")

        # Create text area
        self.text_area = tk.Text(self.root, width=80, height=40)
        self.text_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Create project tree
        self.project_tree = ttk.Treeview(self.root, show="tree")
        self.project_tree.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        # Create root node
        self.root_node = self.project_tree.insert("", "end", text="Project", open=True)

        # Populate project tree with files and directories
        self.populate_tree(self.root_node, os.getcwd())

        # Create menu
        self.menu = tk.Menu(self.root)
        self.root.config(menu=self.menu)

        # Create file menu
        self.file_menu = tk.Menu(self.menu, tearoff=0)
        self.file_menu.add_command(label="New File", command=self.create_new_file)
        self.file_menu.add_command(label="Open File", command=self.open_file)
        self.menu.add_cascade(label="File", menu=self.file_menu)

    def populate_tree(self, parent, path):
        try:
            for item in os.listdir(path):
                  item_path = os.path.join(path, item)
                  if os.path.isdir(item_path):
                     node = self.project_tree.insert(parent, "end", text=item, open=True)
                     self.populate_tree(node, item_path)
                  else:
                     self.project_tree.insert(parent, "end", text=item)
        except PermissionError:
            print(f"Permission denied for {path}")

    def create_new_file(self):
        # Create new file dialog
        file_name = simpledialog.askstring("Create New File", "Enter file name")
        if file_name:
            file_path = os.path.join(os.getcwd(), file_name)
            if not os.path.exists(file_path):
                with open(file_path, "w") as f:
                    f.write("")
                self.project_tree.insert(self.root_node, "end", text=file_name)
            else:
                tk.messagebox.showerror("Error", "File already exists")

    def open_file(self):
        # Open file dialog
        file_name = filedialog.askopenfilename()
        if file_name:
            if file_name.endswith(('.txt', '.py', '.java', '.c', '.cpp')):
                self.text_area.delete(1.0, tk.END)
                self.text_area.insert(tk.END, open(file_name, "r").read())
            else:
                tk.messagebox.showerror("Error", "Only text files are supported")

if __name__ == "__main__":
    root = tk.Tk()
    ide = IDE(root)
    root.mainloop()
