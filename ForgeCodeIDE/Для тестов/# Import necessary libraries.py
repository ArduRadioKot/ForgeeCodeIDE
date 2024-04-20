from PIL import Image, ImageTk
import tkinter as tk

# Open the image file
img = Image.open('FogeCod.png')

# Create a Tkinter window
root = tk.Tk()
root.geometry('800x00')
# Create a Tkinter-compatible photo image from the PIL image
tk_img = ImageTk.PhotoImage(img)

# Create a label with the photo image
label = tk.Label(root, image=tk_img)
label.pack()

# Schedule a callback function to destroy the window after a delay
root.after(5000, root.destroy)

# Run the Tkinter event loop
root.mainloop()