import type { VerificationPackageCode } from '@splitin/verification-adapter-sdk';

export function verificationCopy(packageCode: VerificationPackageCode | string): {
  title: string;
  description: string;
  reviewTitle: string;
} {
  switch (packageCode) {
    case 'business_kyb':
      return {
        title: 'Secure business verification',
        description: 'The legal business is verified separately from your identity. You can pause and resume without starting over.',
        reviewTitle: 'Business review is in progress',
      };
    case 'ownership_review':
      return {
        title: 'Ownership and authority review',
        description: 'We are reviewing authority for this organization. Your action stays saved.',
        reviewTitle: 'Ownership review is in progress',
      };
    case 'associated_person_idv':
      return {
        title: 'Associated person verification',
        description: 'This identity check supports a separate business relationship review.',
        reviewTitle: 'Relationship review is in progress',
      };
    default:
      return {
        title: 'Secure identity verification',
        description: 'You can pause and resume without starting over. Your action stays saved.',
        reviewTitle: 'Identity review is in progress',
      };
  }
}

export const CAMERA_HELP = [
  'Allow camera access in browser settings, close other camera apps, then retry.',
  'Use an up-to-date Safari, Chrome, Firefox, or Edge browser. If an in-app browser blocks the camera, open the continuation link in your main browser.',
];
