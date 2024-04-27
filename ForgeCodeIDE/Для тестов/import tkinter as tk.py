import tkinter as tk
from tkinter import filedialog, messagebox
import os
import tkinter.ttk as ttk

class TextEditor(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Simple Text Editor")
        self.geometry("800x600")

        self.text_widget = tk.Text(self)
        self.text_widget.pack(expand=True, fill=tk.BOTH)

        self.menu = tk.Menu(self)
        self.file_menu = tk.Menu(self.menu, tearoff=0)
        self.file_menu.add_command(label="Open", command=self.open_file)
        self.file_menu.add_command(label="Save", command=self.save_file)
        self.file_menu.add_command(label="Exit", command=self.quit)
        self.menu.add_cascade(label="File", menu=self.file_menu)
        self.config(menu=self.menu)

        self.project_tree = ttk.Treeview(self)
        self.project_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.project_tree["columns"] = ("1")
        self.project_tree.column("#0", width=200, minwidth=200)
        self.project_tree.column("1", width=300, minwidth=300)

        self.project_tree.heading("#0", text="File Name")
        self.project_tree.heading("1", text="Path")

        self.project_tree.tag_configure("even", background="white")
        self.project_tree.tag_configure("odd", background="lightgray")

    def open_file(self):
        file_path = filedialog.askopenfilename()
        if not file_path:
            return

        with open(file_path, "r") as file:
            self.text_widget.insert("1.0", file.read())

        file_name = os.path.basename(file_path)
        file_info = (file_name, file_path)
        self.project_tree.insert("", "end", text=file_name, values=(file_path,), tags=("even",))

    def save_file(self):
        file_path = filedialog.asksaveasfilename()
        if not file_path:
            return

        with open(file_path, "w") as file:
            file.write(self.text_widget.get("1.0", "end-1c"))

        for child in self.project_tree.get_children():
            file_name, file_path = self.project_tree.item(child)["values"]
            if file_path == file_path:
                self.project_tree.item(child, text=os.path.basename(file_path), values=(file_path,))
                break
        else:
            file_name = os.path.basename(file_path)
            self.project_tree.insert("", "end", text=file_name, values=(file_path,), tags=("even",))

    def quit(self):
        if messagebox.askokcancel("Quit", "Do you want to quit?"):
            self.destroy()

if __name__ == "__main__":
    app = TextEditor()
    app.mainloop()