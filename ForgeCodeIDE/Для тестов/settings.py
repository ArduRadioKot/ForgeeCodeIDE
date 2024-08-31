import customtkinter as ctk
from tkinter import simpledialog, filedialog, messagebox
from customtkinter import CTk, CTkLabel, CTkButton,  CTkToplevel, CTkImage
import tkinter as tk
from PIL import Image, ImageTk
ctk.set_appearance_mode("System")  # Modes: "System" (standard), "Dark", "Light"
ctk.set_default_color_theme("green") 

class Settings:
    def __init__(self, master):
        self.master = master
        self.settings_window = ctk.CTkToplevel(self.master)

        # Create a label for the settings window
        settings_label = ctk.CTkLabel(self.settings_window, text="Settings")
        settings_label.pack()

        # Create a frame for the font size settings
        font_size_frame = ctk.CTkFrame(self.settings_window)
        font_size_frame.pack()

        # Create a label for the font size settings
        font_size_label = ctk.CTkLabel(font_size_frame, text="Font Size:")
        font_size_label.pack(side=tk.LEFT)

        # Create a spinbox for the font size settings
        self.font_size = ctk.CTkSpinbox(font_size_frame, from_=8, to=72, increment=2)
        self.font_size.pack(side=tk.LEFT)

        # Create a button to apply the font size settings
        apply_button = ctk.CTkButton(self.settings_window, text="Apply", command=self.apply_font_size)
        apply_button.pack()

        # Create a frame for the theme settings
        theme_frame = ctk.CTkFrame(self.settings_window)
        theme_frame.pack()

        # Create a label for the theme settings
        theme_label = ctk.CTkLabel(theme_frame, text="Theme:")
        theme_label.pack(side=tk.LEFT)

        # Create a variable to store the theme selection
        self.theme_var = tk.StringVar()

        # Create a radio button for the light theme
        light_theme_radio = ctk.CTkRadioButton(theme_frame, text="Light", variable=self.theme_var, value="Light")
        light_theme_radio.pack(side=tk.LEFT)

        # Create a radio button for the dark theme
        dark_theme_radio = ctk.CTkRadioButton(theme_frame, text="Dark", variable=self.theme_var, value="Dark")
        dark_theme_radio.pack(side=tk.LEFT)

        plugins_frame = ctk.CTkFrame(self.settings_window)
        plugins_frame.pack()

        # Create a label for the plugins settings
        plugins_label = ctk.CTkLabel(plugins_frame, text="Plugins:")
        plugins_label.pack(side=tk.LEFT)

        # Create a listbox for the plugins
        self.plugins_listbox = tk.Listbox(plugins_frame, width=40)
        self.plugins_listbox.pack(side=tk.LEFT)

        # Create a button to add a plugin
        add_plugin_button = ctk.CTkButton(plugins_frame, text="Add Plugin", command=self.add_plugin)
        add_plugin_button.pack(side=tk.LEFT)

        # Create a button to remove a plugin
        remove_plugin_button = ctk.CTkButton(plugins_frame, text="Remove Plugin", command=self.remove_plugin)
        remove_plugin_button.pack(side=tk.LEFT)

    def apply_font_size(self):
        # Get the font size from the spinbox
        font_size = int(self.font_size.get())

        # Set the font size of the text editor
        self.master.text_area.config(font=("Consolas", font_size))

    def add_plugin(self):
        # Open a file dialog to select a plugin to add
        file_path = filedialog.askopenfilename(filetypes=[('Plugin files', '*.py')])

        # If a file was selected, add it to the list of plugins
        if file_path:
            self.plugins_listbox.insert(tk.END, file_path)

    def remove_plugin(self):
        # Get the selected plugin from the listbox
        plugin = self.plugins_listbox.get(self.plugins_listbox.curselection())

        # Remove the plugin from the list of plugins
        self.plugins_listbox.delete(self.plugins_listbox.curselection())