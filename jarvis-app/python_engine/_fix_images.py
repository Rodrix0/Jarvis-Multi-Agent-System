# -*- coding: utf-8 -*-
"""Fix placeholder images in the latest generated project."""
import re, os

PROJECT = os.path.join(os.path.expanduser("~"), "Desktop", "Jarvis_Projects", "cafe_ecommerce_ui", "index.html")

with open(PROJECT, "r", encoding="utf-8") as f:
    html = f.read()

count_before = html.count("via.placeholder.com")
print(f"Placeholders encontrados: {count_before}")

# Hero background
html = re.sub(
    r'https?://via\.placeholder\.com/1500x400[^"]*',
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1400&h=600&fit=crop',
    html,
)
# Logo (150px)
html = re.sub(
    r'https?://via\.placeholder\.com/150"',
    'https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=40&h=40&fit=crop"',
    html,
)

# Product images (rotación)
IMGS = [
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1514432324607-a09d9b4aefda?w=400&h=400&fit=crop",
    "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop",
]
idx = [0]

def next_img(m):
    url = IMGS[idx[0] % len(IMGS)]
    idx[0] += 1
    return url

html = re.sub(r'https?://via\.placeholder\.com/[^"]*', next_img, html)

count_after = html.count("via.placeholder.com")
unsplash_count = html.count("images.unsplash.com")
print(f"Placeholders restantes: {count_after}")
print(f"URLs Unsplash inyectadas: {unsplash_count}")

with open(PROJECT, "w", encoding="utf-8") as f:
    f.write(html)

print("Archivo actualizado!")
