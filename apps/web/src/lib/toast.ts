import { type ExternalToast, toast } from 'sonner';

export function showSuccess(message: string, options?: ExternalToast) {
  toast.success(message, options);
}

export function showError(message: string, options?: ExternalToast) {
  toast.error(message, options);
}

export function showInfo(message: string, options?: ExternalToast) {
  toast.info(message, options);
}
