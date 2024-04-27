# Import necessary libraries
import tkinter as tk
from tkinter import filedialog
from pygments import highlight
from pygments.lexers import CppLexer
from pygments.formatters import TerminalFormatter
from PIL import Image, ImageTk
from tkinter import Tk, Menu, Text, END, BOTH, Toplevel, Label
from tkinter.filedialog import asksaveasfilename, askopenfilename
import subprocess
import os
from tkinter import scrolledtext



#Create a Tkinter window
root = tk.Tk()
root.geometry('500x500')
# Create a Tkinter-compatible photo image from the PIL image
img = Image.open('FCI.png')
tk_img = ImageTk.PhotoImage(img)

# Create a label with the photo image
label = tk.Label(root, image=tk_img)
label.pack()

# Schedule a callback function to destroy the window after a delay
root.after(5000, root.destroy)

# Run the Tkinter event loop
root.mainloop()

# Define the main IDE class
class IDE(tk.Tk):

    def __init__(self):
        # Initialize the superclass (tk.Tk)
        super().__init__()
        
        # Set the window title
        self.title("ForgeCodeIDE")

        # Set the window size to 800x600 pixels
        self.geometry("1624x865")

        # Create a menu for the IDE
        self.menu = Menu(self)

        # Configure the IDE to use the created menu
        self.config(menu=self.menu)

        # Create a text editor widget for the IDE
        #self.text_editor = tk.Text(self, width=160, height=40)
        self.text_editor = scrolledtext.ScrolledText(self, width=160, height=40)
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
        new_tab_button = tk.Button(button_frame, text="New Tab", bd=2,  padx=5, pady=5, command=self.new_tab)

        # Grid the new tab button in the third row and first column of the button frame
        new_tab_button.grid(row=2, column=0)

        # Create a clear terminal button
        clear_terminal_button = tk.Button(button_frame, text="Clear Terminal", bd=2, padx=5, pady=5, command=self.clear_terminal)

        # Grid the clear terminal button in the fourth row and first column of the button frame
        clear_terminal_button.grid(row=3, column=0)

        # Create a settings button
        settings_button = tk.Button(button_frame, text="Settings", bd=2, padx=5, pady=5, command=self.settings)

        # Grid the settings button in the fifth row and first column of the button frame
        settings_button.grid(row=4, column=0)

        # Initialize an empty list to store the tabs
        self.tabs = []

        # Create a terminal widget for the IDE
        self.co_res = Text(height=12, fg='white')

        # Pack the terminal widget into the IDE window
        self.co_res.pack(expand=1, fill=BOTH)

        # Create a menu for the IDE
        menu_bar = Menu(self)

        # Add a file menu to the menu bar
        file_menu = Menu(menu_bar, tearoff=0)
        file_menu.add_command(label='Open', command=self.open_file)
        file_menu.add_command(label='Save', command=self.save_file)
        file_menu.add_command(label='Save As', command=self.save_file)
        file_menu.add_command(label='Run', command=self.run)
        file_menu.add_command(label='Exit', command=self.exit)
        menu_bar.add_cascade(label='File', menu=file_menu)

        # Add a run menu to the menu bar
        menu_bar.add_command(label='Run', command=self.run)

        # Configure the IDE to use the created menu
        self.config(menu=menu_bar)

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
      file_path = filedialog.askopenfilename(filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ('ForgeCode', '*.fce'), ('Python files', '*.py'),('WEB(HTML) files', '*.html'), ('C files', '*.c')])
    # If a file was selected, open it and insert its contents into the text editor
      if file_path:
          with open(file_path, 'r') as file:
              code = file.read()
              self.text_editor.delete('1.0', tk.END)
              self.text_editor.insert(tk.END, code)

    def save_file(self):
        # Open a file dialog to select a file to save
        file_path = filedialog.asksaveasfilename(defaultextension=".cppx", filetypes=[ ('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ('ForgeCode', '*.fce'),('Python files', '*.py'),('WEB(HTML) files', '*.html'), ('C files', '*.c')])
        # If a file was selected, save the contents of the text editor to the file
        if file_path:
            with open(file_path, 'w') as file:
                code = self.text_editor.get("1.0", tk.END)
                file.write(code)

    def new_tab(self):
        # Create a new tab and add it to the list of tabs
        new_tab = Tab(self)
        self.tabs.append(new_tab)

    def run(self):
        # Open a file dialog to select a file to run
        file_path = filedialog.askopenfilename(filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ('ForgeCode', '*.fce'),('Python files', '*.py'),('WEB(HTML) files', '*.html')])
        # If a file was selected, run it and display the output in the terminal widget
        if file_path:
            command = f'python {file_path}'
            process = subprocess.Popen(['cmd.exe', '/k', command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
            output, error = process.communicate()
            self.co_res.insert(END, os.getcwd())
            self.co_res.insert(END, '\>')
            self.co_res.insert(END, '\n')
            self.co_res.insert(END, 'output:')
            self.co_res.insert(END, '\n')
            self.co_res.insert(END, output)
            self.co_res.insert(END, '\n')
            self.co_res.insert(END, 'error:')
            self.co_res.insert(END, '\n')
            if error == b'':
                self.co_res.config(fg='green')
                self.co_res.insert(END, 'No errors')
            else:
                self.co_res.config(fg='red')
                self.co_res.insert(END, error)

    def clear_terminal(self):
        # Clear the contents of the terminal widget
        self.co_res.delete('1.0', tk.END)

    def exit(self):
        self.quit()


    #...

    def settings(self):
        # Create a settings window
        settings_window = tk.Toplevel(self)

        # Create a label for the settings window
        settings_label = tk.Label(settings_window, text="Settings")

        # Pack the label into the settings window
        settings_label.pack()

        # Create a frame for the font size settings
        font_size_frame = tk.Frame(settings_window)

        # Pack the frame into the settings window
        font_size_frame.pack()

        # Create a label for the font size settings
        font_size_label = tk.Label(font_size_frame, text="Font Size:")

        # Pack the label into the frame
        font_size_label.pack(side=tk.LEFT)

        # Create a spinbox for the font size settings
        self.font_size = tk.Spinbox(font_size_frame, from_=8, to=72, increment=2)

        # Pack the spinbox into the frame
        self.font_size.pack(side=tk.LEFT)

        # Create a button to apply the font size settings
        apply_button = tk.Button(settings_window, text="Apply", command=self.apply_font_size)

        # Pack the button into the settings window
        apply_button.pack()

        # Create a frame for the theme settings
        theme_frame = tk.Frame(settings_window)

        # Pack the frame into the settings window
        theme_frame.pack()

        # Create a label for the theme settings
        theme_label = tk.Label(theme_frame, text="Theme:")

        # Pack the label into the frame
        theme_label.pack(side=tk.LEFT)

        # Create a variable to store the theme selection
        self.theme_var = tk.StringVar()

        # Create a radio button for the light theme
        light_theme_radio = tk.Radiobutton(theme_frame, text="Light", variable=self.theme_var, value="light")

        # Pack the radio button into the frame
        light_theme_radio.pack(side=tk.LEFT)

        # Create a radio button for the dark theme
        dark_theme_radio = tk.Radiobutton(theme_frame, text="Dark", variable=self.theme_var, value="dark")

        # Pack the radio button into the frame
        dark_theme_radio.pack(side=tk.LEFT)

        # Create a radio button for the monokai theme
        monokai_theme_radio = tk.Radiobutton(theme_frame, text="Monokai", variable=self.theme_var, value="monokai")

        # Pack the radio button into the frame
        monokai_theme_radio.pack(side=tk.LEFT)

        # Create a radio button for the solarized dark theme
        solarized_dark_theme_radio = tk.Radiobutton(theme_frame, text="Solarized Dark", variable=self.theme_var, value="solarized_dark")

        # Pack the radio button into the frame
        solarized_dark_theme_radio.pack(side=tk.LEFT)

        # Create a radio button for the solarized light theme
        solarized_light_theme_radio = tk.Radiobutton(theme_frame, text="Solarized Light", variable=self.theme_var, value="solarized_light")

        solarized_dark_theme_radio.pack(side=tk.LEFT)

        gd_theme_radio = tk.Radiobutton(theme_frame, text="Gruvbox_dark", variable=self.theme_var, value="gruvbox_dark")

        gd_theme_radio.pack(side=tk.LEFT)

        gl_theme_radio = tk.Radiobutton(theme_frame, text="Gruvbox_light", variable=self.theme_var, value="gruvbox_light")

        gl_theme_radio.pack(side=tk.LEFT)

        d_theme_radio = tk.Radiobutton(theme_frame, text="Dracula", variable=self.theme_var, value="dracula")

        d_theme_radio.pack(side=tk.LEFT)

        n_theme_radio = tk.Radiobutton(theme_frame, text="Nord", variable=self.theme_var, value="nord")

        n_theme_radio.pack(side=tk.LEFT)
        
        od_theme_radio = tk.Radiobutton(theme_frame, text="One dark", variable=self.theme_var, value="one_dark")

        od_theme_radio.pack(side=tk.LEFT)
        
        ol_theme_radio = tk.Radiobutton(theme_frame, text="One light", variable=self.theme_var, value="one_light")

        ol_theme_radio.pack(side=tk.LEFT)



        # Pack the radio button into the frame
        solarized_light_theme_radio.pack(side=tk.LEFT)

        # Create a button to apply the theme settings
        apply_theme_button = tk.Button(settings_window, text="Apply", command=self.apply_theme)

        # Pack the button into the settings window
        apply_theme_button.pack()

    def apply_font_size(self):
        # Get the font size from the spinbox
        font_size = int(self.font_size.get())

        # Set the font size of the text editor
        self.text_editor.config(font=("Consolas", font_size))

    

    def apply_theme(self):
        # Get the theme selection from the radio buttons
        theme = self.theme_var.get()

        # Apply the theme to the text editor
        if theme == "light":
            self.text_editor.config(bg="white", fg="black")
            self.co_res.config(bg="white", fg="black")
            # self.config(bg="white")
        elif theme == "dark":
            self.text_editor.config(bg="black", fg="white")
            self.co_res.config(bg="black", fg="white")
            # self.config(bg="black")
        elif theme == "monokai":
            self.text_editor.config(bg="black", fg="white", insertbackground="green")
            self.co_res.config(bg="black", fg="green")
            # self.config(bg="black")
        elif theme == "solarized_dark":
            self.text_editor.config(bg="#002b36", fg="white", insertbackground="green")
            self.co_res.config(bg="#002b36", fg="green")
            # self.config(bg="#002b36")
        elif theme == "solarized_light":
            self.text_editor.config(bg="#fdf6e3", fg="black", insertbackground="blue")
            self.co_res.config(bg="#fdf6e3", fg="blue")
            # self.config(bg="#fdf6e3")
        elif theme == "gruvbox_dark":
            self.text_editor.config(bg="#282828", fg="white", insertbackground="green")
            self.co_res.config(bg="#282828", fg="green")
            # self.config(bg="#282828")
        elif theme == "gruvbox_light":
            self.text_editor.config(bg="#fbf1c7", fg="black", insertbackground="blue")
            self.co_res.config(bg="#fbf1c7", fg="blue")
            # self.config(bg="#fbf1c7")
        elif theme == "dracula":
            self.text_editor.config(bg="#282a36", fg="white", insertbackground="green")
            self.co_res.config(bg="#282a36", fg="green")
            # self.config(bg="#282a36")
        elif theme == "nord":
            self.text_editor.config(bg="#2e3440", fg="white", insertbackground="green")
            self.co_res.config(bg="#2e3440", fg="green")
            # self.config(bg="#2e3440")
        elif theme == "one_dark":
            self.text_editor.config(bg="#282c34", fg="white", insertbackground="green")
            self.co_res.config(bg="#282c34", fg="green")
            # self.config(bg="#282c34")
        elif theme == "one_light":
            self.text_editor.config(bg="#fafafa", fg="black", insertbackground="blue")
            self.co_res.config(bg="#fafafa", fg="blue")
            # self.config(bg="#fafafa")

        # Apply the theme to the buttons
        # for widget in self.winfo_children():
        #     if isinstance(widget, tk.Button):
        #         if theme == "light":
        #             widget.config(bg="white", fg="black")
        #         elif theme == "dark":
        #             widget.config(bg="black", fg="white")
        #         elif theme == "monokai":
        #             widget.config(bg="black", fg="white")
        #         elif theme == "solarized_dark":
        #             widget.config(bg="#


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
        file_path = filedialog.asksaveasfilename(defaultextension=".cpp", filetypes=[('C++ files', '*.h'), ('C++ files', '*.cpp'), ('Arduino files', '*.ino'), ' C files', '*.C'])

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
    ide.mainloop()