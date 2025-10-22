# Chapter 1 — Introduction

## **1.1  The purpose of this book**

This book describes a small programming language called **k**.
It is meant to show how data can be represented and transformed in a uniform, precise way.
The goal is not to replace existing languages but to expose a clear and minimal model of computation.

Anyone who understands basic programming and data structures can read this book.
Formulas will appear later, but every idea can be followed by reading the text and studying examples.

---

## **1.2  Data as trees**

All information in k is treated as a **tree**.
A tree has:

* a single root,
* labeled edges (field names or tags),
* and possibly subtrees.

A JSON object or an XML document are both trees in this sense.
Every k value is such a finite labeled tree.

---

## **1.3  Functions that may fail**

In ordinary mathematics a function always returns a result.
In k, a function may be **undefined** for some inputs.
For example, asking for the field `.age` in a record that has no `age` is undefined.

We call such mappings **partial functions**.
They describe what a program *can* compute, and quietly leave other cases unspecified.

---

## **1.4  Simplicity over features**

k avoids most language constructs:
no loops, no variables, no control statements.
It has only:

1. **types** (which describe tree shapes), and
2. **partial functions** (which transform one tree into another).

These two ingredients are sufficient to express structured computation.

---

## **1.5  Why study k**

* k shows how data types can be treated as *automata* that recognize tree structures.
* It connects programming with the theory of finite representations.
* It offers a concrete path from abstract syntax to real machine code.

The same ideas appear in modern compilers and schema systems, but here they are reduced to their essentials.

---

## **1.6  What follows**

Part I introduces:

* the notation for writing values and functions,
* how types are formed, and
* how functions are combined.

Later parts describe how to represent values in memory and how to compile k programs into LLVM code.

At the end of the first part, the reader should be able to read and understand small k programs, even without writing a compiler.

---