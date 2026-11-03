import { createContext } from 'react';

/** How many groups enclose a control; only the outermost is tinted, and a card resets it, since its body is white again. */
export const GroupDepthContext = createContext(0);
