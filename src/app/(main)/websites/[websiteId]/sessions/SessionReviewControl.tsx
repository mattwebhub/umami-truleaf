'use client';

import {
  Button,
  Column,
  Dialog,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  ListItem,
  Modal,
  Select,
  Text,
  TextField,
  useToast,
} from '@umami/react-zen';
import { useState } from 'react';
import { useApi, useWebsite } from '@/components/hooks';

export function SessionReviewControl({
  websiteId,
  sessionId,
}: {
  websiteId: string;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const { post, useMutation } = useApi();
  const website = useWebsite();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: (values: { reason: string; severity: string }) =>
      post(`/websites/${websiteId}/session-reviews`, {
        ...values,
        sessionId,
      }),
    onSuccess: () => {
      toast('Session added to the review queue');
      setOpen(false);
    },
  });

  if (!website.canUpdate) return null;

  return (
    <>
      <Button variant="outline" onPress={() => setOpen(true)}>
        Add to review queue
      </Button>
      <Modal isOpen={open} onOpenChange={setOpen} isDismissable>
        <Dialog title="Review this session">
          <Form
            defaultValues={{ severity: 'medium', reason: '' }}
            error={mutation.error?.message}
            onSubmit={values => mutation.mutateAsync(values)}
          >
            <Column gap>
              <Text>
                Queue state is operator-authored and separate from visitor analytics. Adding a
                review does not ban the session.
              </Text>
              <FormField
                name="severity"
                label="Severity"
                rules={{ required: 'Severity is required' }}
              >
                <Select>
                  <ListItem id="low">Low</ListItem>
                  <ListItem id="medium">Medium</ListItem>
                  <ListItem id="high">High</ListItem>
                </Select>
              </FormField>
              <FormField
                name="reason"
                label="Reason"
                rules={{
                  required: 'Reason is required',
                  minLength: { value: 3, message: 'Use at least 3 characters' },
                  maxLength: { value: 500, message: 'Use no more than 500 characters' },
                }}
              >
                <TextField asTextArea />
              </FormField>
              <FormButtons>
                <Button onPress={() => setOpen(false)}>Cancel</Button>
                <FormSubmitButton variant="primary" isDisabled={mutation.isPending}>
                  Add review
                </FormSubmitButton>
              </FormButtons>
            </Column>
          </Form>
        </Dialog>
      </Modal>
    </>
  );
}
