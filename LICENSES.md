# Third-party licences

## Icons

Every icon in the app comes from **Hicon Circular Interface Icons** by *hicon*,
obtained through [svgrepo.com](https://www.svgrepo.com/collection/hicon-circular-interface-icons/)
and released under the **MIT Licence**. The icons live in `src/icons.tsx`,
redrawn as React components on a shared 24x24 grid; the geometry is unchanged.

Six glyphs in that file are **not** from Hicon and are marked as house glyphs:
the table, add-row, add-column and clear-formatting marks in the notes toolbar,
the drag grip, and the apps-launcher grid. Hicon has no sourced equivalent for
any of them (the apps grid is a placeholder for one that likely exists in the
Hicon set but wasn't reachable when it was added -- see the comment in
`icons.tsx`).

The Iron Man helmet in `src/helmet.tsx` and the Mission Control logo mark in
`src/App.tsx` are ours and are not part of any icon set.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
