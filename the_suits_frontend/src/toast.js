// Toast notifications: notify(message, type?) from anywhere under
// <ToastProvider>. type: "success" | "error" | "warning" | "info".
import { createContext, useContext } from "react";

export const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);
