# Dependencies: pandoc, dejavu-fonts-all, texlive-xetex

CHAPTERS = book/01-introduction.md \
           book/02-syntax-and-values.md \
           book/03-types-as-finite-automata.md \
           book/04-partial-functions-and-composition.md \
           book/05-typing-filters-and-normalization.md \
           book/06-values-in-memory.md \
           book/07-the-partial-function-abi.md \
           book/08-operational-semantics-and-execution.md \
           book/09-compiler-architecture.md \
           book/10-from-ast-to-intermediate-representation.md \
           book/11-llvm-basics.md \
           book/12-code-generation.md \
           book/13-linking-and-execution.md \
           book/14-canonical-serialization.md \
           book/15-optimization-and-folding.md \
           book/16-toward-a-universal-schema-registry.md \
           book/appendix-a-implementing-a-prototype-compiler-in-python.md \
           book/appendix-b-incorporating-external-predefined-types-and-functions.md

all: book-combined.pdf book-combined.html book-combined.tex book.pdf book.html book.tex

# Combined book from individual chapters
book-combined.md: $(CHAPTERS)
	echo "---" > book-combined.md
	echo "title: \"k-language\"" >> book-combined.md
	echo "author: \"W. Fraczak\"" >> book-combined.md
	echo "---" >> book-combined.md
	echo "" >> book-combined.md
	echo "<div align=\"center\">" >> book-combined.md
	echo "" >> book-combined.md
	echo "\`\`\`" >> book-combined.md
	echo "      { }                         { }" >> book-combined.md
	echo "     /   \\       {.lang name}      |" >> book-combined.md
	echo "   lang   by          -->         name" >> book-combined.md
	echo "    |      |                       |" >> book-combined.md
	echo "   'k'  'wojtek'                  'k'" >> book-combined.md
	echo "\`\`\`" >> book-combined.md
	echo "" >> book-combined.md
	echo "</div>" >> book-combined.md
	echo "" >> book-combined.md
	echo "# Table of Contents" >> book-combined.md
	echo "" >> book-combined.md
	echo "1. [Introduction](#chapter-1-introduction)" >> book-combined.md
	echo "2. [Syntax and Values](#chapter-2-syntax-and-values)" >> book-combined.md
	echo "3. [Types as Finite Automata](#chapter-3-types-as-finite-automata)" >> book-combined.md
	echo "4. [Partial Functions and Composition](#chapter-4-partial-functions-and-composition)" >> book-combined.md
	echo "5. [Typing, Filters, and Normalization](#chapter-5-typing-filters-and-normalization)" >> book-combined.md
	echo "6. [Values in Memory](#chapter-6-values-in-memory)" >> book-combined.md
	echo "7. [The Partial Function ABI](#chapter-7-the-partial-function-abi)" >> book-combined.md
	echo "8. [Operational Semantics and Execution](#chapter-8-operational-semantics-and-execution)" >> book-combined.md
	echo "9. [Compiler Architecture](#chapter-9-compiler-architecture)" >> book-combined.md
	echo "10. [From AST to Intermediate Representation](#chapter-10-from-ast-to-intermediate-representation)" >> book-combined.md
	echo "11. [LLVM Basics](#chapter-11-llvm-basics)" >> book-combined.md
	echo "12. [Code Generation](#chapter-12-code-generation)" >> book-combined.md
	echo "13. [Linking and Execution](#chapter-13-linking-and-execution)" >> book-combined.md
	echo "14. [Canonical Serialization](#chapter-14-canonical-serialization)" >> book-combined.md
	echo "15. [Optimization and Folding](#chapter-15-optimization-and-folding)" >> book-combined.md
	echo "16. [Toward a Universal Schema Registry](#chapter-16-toward-a-universal-schema-registry)" >> book-combined.md
	echo "" >> book-combined.md
	echo "## Appendices" >> book-combined.md
	echo "" >> book-combined.md
	echo "- [Appendix A: Implementing a Prototype Compiler in Python](#appendix-a-implementing-a-prototype-compiler-in-python)" >> book-combined.md
	echo "- [Appendix B: Incorporating External Predefined Types and Functions](#appendix-b-incorporating-external-predefined-types-and-functions)" >> book-combined.md
	echo "" >> book-combined.md
	echo "---" >> book-combined.md
	echo "" >> book-combined.md
	for chapter in $(CHAPTERS); do \
		echo "" >> book-combined.md; \
		cat $$chapter >> book-combined.md; \
		echo "" >> book-combined.md; \
		echo "---" >> book-combined.md; \
		echo "" >> book-combined.md; \
	done

book-combined.tex: book-combined.md
	pandoc book-combined.md -t latex -s -o book-combined.tex

book-combined.pdf: book-combined.md
	pandoc book-combined.md --pdf-engine=xelatex -V monofont="DejaVu Sans Mono" -V mainfont="DejaVu Serif" -o book-combined.pdf

book-combined.html: book-combined.md
	pandoc book-combined.md -o book-combined.html

# Master file (table of contents only)
book.tex: book.md
	pandoc book.md -t latex -s -o book.tex

book.pdf: book.md
	pandoc book.md --pdf-engine=xelatex -V monofont="DejaVu Sans Mono" -V mainfont="DejaVu Serif" -o book.pdf

book.html: book.md
	pandoc book.md -o book.html

clean:
	rm -f book.pdf book.html book.tex book-combined.* *.aux *.log *.out

.PHONY: all clean
