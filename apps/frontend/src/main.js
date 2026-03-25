import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
function App() {
    return (_jsxs("div", { children: [_jsx("h1", { children: "Lixeta Demo" }), _jsx("p", { children: "Frontend working!" })] }));
}
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
