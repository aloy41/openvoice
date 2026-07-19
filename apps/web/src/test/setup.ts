import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so RTL cannot auto-register its cleanup hook.
afterEach(() => cleanup());
