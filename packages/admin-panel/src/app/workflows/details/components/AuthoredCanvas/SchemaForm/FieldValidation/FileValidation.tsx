import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Input } from '@/components/ui/Input/Input';
import { Add, Close } from '@/components/ui/icons';
import { FieldRow } from '../FieldRow';
import { setMember } from '../form-values';
import { ValidationNumberInput } from './ValidationNumberInput';
import {
  BYTES_PER_MEGABYTE,
  IMAGE_CONTENT_TYPE_PREFIX,
  MEGABYTE_DECIMALS,
  readNumber,
  readStrings,
  type ValidationEditorProps,
} from './validation-values';

/** Every content type filled in is an image; a row still empty counts as none, so adding one keeps the dimensions. */
function isImageOnlyList(contentTypes: string[]): boolean {
  const filled = contentTypes.filter((type) => type !== '');
  return filled.length > 0 && filled.every((type) => type.startsWith(IMAGE_CONTENT_TYPE_PREFIX));
}

export function FileValidation({ value, onChange, readOnly }: ValidationEditorProps): ReactElement {
  const contentTypes = readStrings(value.contentTypes);
  const bytes = readNumber(value.maxSizeBytes);
  const isImageOnly = isImageOnlyList(contentTypes);

  // Dimensions are only valid for images; they go once a non-image type is settled, never mid-typing.
  const settleDimensions = (current: Record<string, unknown>): Record<string, unknown> =>
    isImageOnlyList(readStrings(current.contentTypes)) ||
    (current.maxImageWidth === undefined && current.maxImageHeight === undefined)
      ? current
      : setMember(setMember(current, 'maxImageWidth', undefined), 'maxImageHeight', undefined);

  const writeContentTypes = (next: string[]): void =>
    onChange(setMember(value, 'contentTypes', next));

  const removeContentType = (index: number): void =>
    onChange(
      settleDimensions(
        setMember(
          value,
          'contentTypes',
          contentTypes.filter((_, at) => at !== index),
        ),
      ),
    );

  const handleContentTypeBlur = (): void => {
    const settled = settleDimensions(value);
    if (settled !== value) onChange(settled);
  };

  return (
    <div className="flex flex-col gap-4">
      <FieldRow label="Content types" required>
        <div className="flex flex-col gap-2">
          {contentTypes.map((type, index) => (
            <div
              // Entries have no identity of their own; removing one re-keys the rest.
              key={index}
              className="flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <Input
                  font="mono"
                  size="sm"
                  aria-label={`Content type ${index + 1}`}
                  disabled={readOnly}
                  value={type}
                  onChange={(event) =>
                    writeContentTypes(
                      contentTypes.map((current, at) =>
                        at === index ? event.target.value : current,
                      ),
                    )
                  }
                  onBlur={handleContentTypeBlur}
                />
              </div>
              {!readOnly && contentTypes.length > 1 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-6 px-1"
                  aria-label={`Remove content type ${index + 1}`}
                  onClick={() => removeContentType(index)}
                >
                  <Close aria-hidden className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button
              size="sm"
              className="self-start"
              aria-label="Add content type"
              onClick={() => writeContentTypes([...contentTypes, ''])}
            >
              <Add aria-hidden className="size-4" />
              Add
            </Button>
          )}
        </div>
      </FieldRow>
      <ValidationNumberInput
        label="Maximum size (MB)"
        min={0}
        step="any"
        readOnly={readOnly}
        value={
          bytes === undefined
            ? undefined
            : Number((bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS))
        }
        onChange={(next) =>
          onChange(
            setMember(
              value,
              'maxSizeBytes',
              next === undefined ? undefined : Math.round(next * BYTES_PER_MEGABYTE),
            ),
          )
        }
      />
      {isImageOnly && (
        <>
          <ValidationNumberInput
            label="Maximum image width (px)"
            min={1}
            readOnly={readOnly}
            value={readNumber(value.maxImageWidth)}
            onChange={(next) => onChange(setMember(value, 'maxImageWidth', next))}
          />
          <ValidationNumberInput
            label="Maximum image height (px)"
            min={1}
            readOnly={readOnly}
            value={readNumber(value.maxImageHeight)}
            onChange={(next) => onChange(setMember(value, 'maxImageHeight', next))}
          />
        </>
      )}
    </div>
  );
}
