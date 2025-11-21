#!/usr/bin/env python3

import re
import os

def split_book():
    # Read the original book
    with open('DOCS/book.md', 'r') as f:
        content = f.read()
    
    # Create book directory
    os.makedirs('DOCS/book', exist_ok=True)
    
    # Split by chapters
    chapters = re.split(r'^## \*\*Chapter (\d+) — (.+?)\*\*$', content, flags=re.MULTILINE)
    
    # Handle the introduction (before first chapter)
    intro_content = chapters[0]
    
    # Extract just the chapter 1 content (after the title page)
    intro_start = intro_content.find('## **Chapter 1 — Introduction**')
    if intro_start != -1:
        chapter1_content = intro_content[intro_start:]
        # Find where chapter 1 ends
        chapter1_end = chapter1_content.find('\n---\n\n## **Chapter 2')
        if chapter1_end != -1:
            chapter1_content = chapter1_content[:chapter1_end]
        
        # Clean up and save Chapter 1
        chapter1_content = chapter1_content.replace('## **Chapter 1 — Introduction**', '# Chapter 1 — Introduction')
        chapter1_content = chapter1_content.replace('### **', '## **')
        
        with open('DOCS/book/01-introduction.md', 'w') as f:
            f.write(chapter1_content.strip())
        print("Created 01-introduction.md")
    
    # Process remaining chapters
    for i in range(1, len(chapters), 3):
        if i+2 < len(chapters):
            chapter_num = chapters[i]
            chapter_title = chapters[i+1]
            chapter_content = chapters[i+2]
            
            # Find where this chapter ends (next chapter or appendix)
            next_chapter_start = chapter_content.find('\n## **Chapter ')
            appendix_start = chapter_content.find('\n## **Appendix')
            
            if next_chapter_start != -1:
                chapter_content = chapter_content[:next_chapter_start]
            elif appendix_start != -1:
                chapter_content = chapter_content[:appendix_start]
            
            # Clean up formatting
            chapter_content = f"# Chapter {chapter_num} — {chapter_title}\n\n{chapter_content}"
            chapter_content = chapter_content.replace('### **', '## **')
            chapter_content = chapter_content.strip()
            
            # Generate filename
            filename = f"{int(chapter_num):02d}-{chapter_title.lower().replace(' ', '-').replace(',', '').replace('(', '').replace(')', '')}.md"
            
            with open(f'DOCS/book/{filename}', 'w') as f:
                f.write(chapter_content)
            print(f"Created {filename}")
    
    # Handle appendices
    appendix_matches = re.findall(r'## \*\*Appendix — (.+?)\*\*\n\n(.*?)(?=\n## \*\*Appendix|\n---\n\n|$)', content, re.DOTALL)
    
    for i, (title, content_text) in enumerate(appendix_matches):
        filename = f"appendix-{chr(97+i)}-{title.lower().replace(' ', '-')}.md"
        content_text = f"# Appendix {chr(65+i)} — {title}\n\n{content_text}"
        content_text = content_text.replace('### **', '## **')
        
        with open(f'DOCS/book/{filename}', 'w') as f:
            f.write(content_text.strip())
        print(f"Created {filename}")

if __name__ == '__main__':
    split_book()
