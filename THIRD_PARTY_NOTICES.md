# Third-Party Notices

This project vendors browser-ready JavaScript bundles in `vendor/` so the QR tool can run locally without downloading libraries at runtime.

The project itself may be distributed under GPLv3. The third-party libraries below remain under their own licenses.

## qrcode

- Package: `qrcode`
- Version: `1.5.3`
- Vendored files:
  - `vendor/qrcode.mjs`
  - `vendor/qrcode.global.js`
- Source package: https://www.npmjs.com/package/qrcode/v/1.5.3
- Repository: https://github.com/soldair/node-qrcode
- License: MIT

MIT License text from the `qrcode@1.5.3` package:

```text
The MIT License (MIT)

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## jsPDF

- Package: `jspdf`
- Version: `2.5.1`
- Vendored files:
  - `vendor/jspdf.mjs`
  - `vendor/jspdf.umd.min.js`
- Source package: https://www.npmjs.com/package/jspdf/v/2.5.1
- Repository: https://github.com/MrRio/jsPDF
- License: MIT

MIT License text from the `jspdf@2.5.1` package:

```text
Copyright
(c) 2010-2021 James Hall, https://github.com/MrRio/jsPDF
(c) 2015-2021 yWorks GmbH, https://www.yworks.com/

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

The `vendor/jspdf.umd.min.js` bundle also contains embedded notices for jsPDF components and bundled code. Those comments are intentionally preserved.
