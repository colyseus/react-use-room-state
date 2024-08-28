import { createId } from "@paralleldrive/cuid2";

const uniqueId = (props: { prefix?: string } = {}) => {
  if (!props.prefix) {
    return createId();
  }
  return props.prefix + "_" + createId();
};

export default uniqueId;
