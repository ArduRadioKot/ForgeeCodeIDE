# Import necessary libraries
import tkinter as tk
from tkinter import filedialog
from pygments import highlight
from pygments.lexers import CppLexer
from pygments.formatters import TerminalFormatter
import time



# Define the main IDE class

class IDE(tk.Tk):

    
    def __init__(self):
        # Initialize the superclass (tk.Tk)
        super().__init__()

        # Set the window title
        self.title("ForgeCodeIDE")

        # Set the window size to 800x600 pixels
        self.geometry("1624x865")
        self.text_editor = tk.Text(self, width=150, height=40)
        self.scrollbar = tk.Scrollbar(self)
        # Create a menu for the IDE
        self.menu = tk.Menu(self)

        # Configure the IDE to use the created menu
        self.config(menu=self.menu)

        # Create a text editor widget for the IDE
        #self.text_editor = tk.Text(self)

        # Pack the text editor widget into the IDE window
        self.text_editor.pack()

        # Bind the on_key_press function to the text editor widget
        self.text_editor.bind("<Key>", self.on_key_press)

        # Create a frame for the open and save file buttons
        button_frame = tk.Frame(self)

        # Pack the button frame into the IDE window
        button_frame.pack(side=tk.LEFT)

        # Create an open file button
        open_button = tk.Button(button_frame, text="Open File", bd=2, padx=5, pady=5, command=self.open_file)

        # Grid the open file button in the first row and first column of the button frame
        open_button.grid(row=0, column=0)

        # Create a save file button
        save_button = tk.Button(button_frame, text="Save File", bd=2, padx=5, pady=5, command=self.save_file)

        # Grid the save file button in the second row and first column of the button frame
        save_button.grid(row=1, column=0)

        # Create a new tab button
        new_tab_button = tk.Button(button_frame, text="New Tab", bd=2, padx=5, pady=5, command=self.new_tab)

        # Grid the new tab button in the third row and first column of the button frame
        new_tab_button.grid(row=2, column=0)

        # Initialize an empty list to store the tabs
        self.tabs = []

    def on_key_press(self, event):
        # Get the code from the text editor
        code = self.text_editor.get("1.0", tk.END)

        # Highlight the code using the CppLexer
        highlighted_code = highlight(code, CppLexer())

        # Delete the existing code in the text editor
        self.text_editor.delete("1.0", tk.END)

        # Insert the highlighted code back into the text editor
        self.text_editor.insert(tk.END, highlighted_code)
        

 

    def open_file(self):
        # Open a file dialog to select a file to open
        file_path = filedialog.askopenfilename(filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ('ForgeCode', '*.fce')])
        # If a file was selected, open it and insert its contents into the text editor
        if file_path:
            with open(file_path, 'r') as file:
                code = file.read()
                self.text_editor.insert(tk.END, code)

    def save_file(self):
        # Open a file dialog to select a file to save
        file_path = filedialog.asksaveasfilename(defaultextension=".cppx", filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ('ForgeCode', '*.fce')])
        # If a file was selected, save the contents of the text editor to the file
        if file_path:
            with open(file_path, 'w') as file:
                code = self.text_editor.get("1.0", tk.END)
                file.write(code)

    def new_tab(self):
        # Create a new tab and add it to the list of tabs
        new_tab = Tab(self)
        self.tabs.append(new_tab)

# Define the Tab class
class Tab:
    def __init__(self, master):
        # Initialize the superclass (tk.Toplevel)
        self.master = master
        self.top = tk.Toplevel(self.master)

        # Create a text editor widget for the tab
        self.text_editor = tk.Text(self.top)

        # Pack the text editor widget into the tab window
        self.text_editor.pack()

        # Create a save tab button
        save_tab_button = tk.Button(self.top, text="Save Tab", bd=2, padx=5, pady=5, command=self.save_tab)

        # Pack the save tab button into the tab window
        save_tab_button.pack(side=tk.RIGHT)

        # Create a close tab button
        close_button = tk.Button(self.top, text="Close Tab", bd=2, padx=5, pady=5, command=self.close_tab)

        # Pack the close tab button into the tab window
        close_button.pack(side=tk.RIGHT)

    def save_tab(self):
        # Open a file dialog to select a file to save
        file_path = filedialog.asksaveasfilename(defaultextension=".cpp", filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino')])

        # If a file was selected, save the contents of the tab's text editor to the file
        if file_path:
            with open(file_path, 'w') as file:
                code = self.text_editor.get("1.0", tk.END)
                file.write(code)

    def close_tab(self):
        # Destroy the tab window
        self.top.destroy()

        # Remove the tab from the list of tabs in the IDE
        self.master.tabs.remove(self)

# Start the IDE
if __name__ == "__main__":
    ide = IDE()

    #create_splash_screen()
    ide.mainloop()