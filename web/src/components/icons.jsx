// Iconos de línea monocromos (heredan el color del texto vía currentColor).
// Sin dependencias externas ni colores fijos.
function Svg({ children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconHistory = () => (
  <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);

export const IconLaunch = () => (
  <Svg><circle cx="12" cy="12" r="9" /><path d="M10 8.5 15.5 12 10 15.5Z" /></Svg>
);

export const IconSchedule = () => (
  <Svg><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></Svg>
);

export const IconCatalog = () => (
  <Svg>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </Svg>
);

export const IconUsers = () => (
  <Svg>
    <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="8" r="4" />
    <path d="M22 20v-2a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const IconAudit = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
  </Svg>
);

export const IconSettings = () => (
  <Svg><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Svg>
);

export const IconServer = () => (
  <Svg>
    <rect x="2.5" y="13" width="19" height="7.5" rx="2" />
    <rect x="2.5" y="3.5" width="19" height="7.5" rx="2" />
    <path d="M6.5 7.25h.01M6.5 16.75h.01" />
  </Svg>
);

export const IconUser = () => (
  <Svg><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>
);

export const IconKey = () => (
  <Svg><circle cx="8" cy="15" r="5" /><path d="M11.6 11.4 20 3M16.5 6.5 19 9M14.5 8.5 17 11" /></Svg>
);

export const IconLogout = () => (
  <Svg><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></Svg>
);

export const IconChevronLeft = () => (
  <Svg><path d="M15 18 9 12l6-6" /></Svg>
);

export const IconChevronDown = () => (
  <Svg><path d="m6 9 6 6 6-6" /></Svg>
);

export const IconClose = () => (
  <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>
);

export const IconArrowLeft = () => (
  <Svg><path d="M19 12H5M12 19l-7-7 7-7" /></Svg>
);

export const IconArrowUp = () => (
  <Svg><path d="M12 19V5M5 12l7-7 7 7" /></Svg>
);

export const IconRefresh = () => (
  <Svg><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></Svg>
);

export const IconFolder = () => (
  <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);

export const IconAlert = () => (
  <Svg><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></Svg>
);
