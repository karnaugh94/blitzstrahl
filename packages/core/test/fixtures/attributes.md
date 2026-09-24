# Heading {.accent #top}

Revenue grew year over year. {.fade-up @1}

Revenue grew [42%]{.pop @+} this year.
[the docs](https://example.com){.muted} ![chart](./q3.png){width=60%} `npm i`{.big}
[**bold** span]{.x}

Literal braces: {foo} and {} and {x, y} and \{.escaped} stay.

Typos are errors: {fade @1}

word{.no-space}

- Point {@+}
- Other {data-foo=bar aria-label="An item"}

> quoted

{.pull-quote}

{.nothing-before-in-a-container-is-fine-here}

```js {.code-attrs @2}
let x = 1
```

```js title="kept as meta"
let y = 2
```

[ref]{.x}

[ref]: https://example.com

Bad keys {unknown=1 style="a: b" title='it\'s' #dup #dup2}

Twice {.a} {.b}
