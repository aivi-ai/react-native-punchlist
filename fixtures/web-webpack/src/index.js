import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { Punchlist, punchlist } from 'react-native-punchlist';

punchlist.addTask('boot');
const container = document.createElement('div');
document.body.appendChild(container);
createRoot(container).render(createElement(View, null, createElement(Punchlist, { enabled: true })));
