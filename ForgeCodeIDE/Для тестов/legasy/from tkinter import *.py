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

        self.project_tree = ttk.Treeview(self, columns=("name"))
        self.project_tree.heading("#0", text="Project")
        self.project_tree.heading("name", text="Name")
        self.project_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Create the Project item
        self.project_tree.insert(parent="", index=0, iid=0, text="Project", values=("My Project"))

        # Create the child items under the Project item
        self.project_tree.insert(parent="Project", index=0, iid=1, text="", values=("File 1.txt"))
        self.project_tree.insert(parent="Project", index=1, iid=2, text="", values=("File 2.txt"))

        self.project_tree.bind("<<TreeviewSelect>>", self.on_tree_select)

        # Create the project directory if it doesn't exist
        self.project_dir = "project"
        if not os.path.exists(self.project_dir):
            os.makedirs(self.project_dir)

    def on_tree_select(self, event):
        selection = self.project_tree.selection()
        if selection:
            file_path = os.path.join(self.project_dir, f"{selection[0]}.txt")
            if os.path.exists(file_path):
                with open(file_path, "r") as file:
                    self.text_widget.delete("1.0", tk.END)
                    self.text_widget.insert("1.0", file.read())

    def open_file(self):
        file_path = filedialog.askopenfilename(filetypes=[("Text Files", "*.txt")])
        if file_path:
            with open(file_path, "r") as file:
                self.text_widget.delete("1.0", tk.END)
                self.text_widget.insert("1.0", file.read())

    def save_file(self):
        file_path = filedialog.asksaveasfilename(defaultextension=".txt", filetypes=[("Text Files", "*.txt")])
        if file_path:
            with open(file_path, "w") as file:
                file.write(self.text_widget.get("1.0", tk.END))

    def quit(self):
        result = messagebox.askquestion("Quit", "Do you want to quit?")
        if result == "yes":
            self.destroy()

if __name__ == "__main__":
    app = TextEditor()
    app.mainloop()