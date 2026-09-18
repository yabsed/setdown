import type { DesktopPort } from '../ports/desktop-port';

/** 브라우저 전역을 애플리케이션 경계의 명시적인 포트로 바꾼다. */
export const electronDesktop: DesktopPort = window.marktex;
