; case integration-005-ackermann
; expect exit=0 stdout="9\n"
.func main arity=0 locals=0
  CLOSURE ack
  PUSH_INT 2
  PUSH_INT 3
  CALL 2
  PRINT
  RET
.end
.func ack arity=2 locals=2
  LOAD_LOCAL 0
  PUSH_INT 0
  EQ
  JMP_IF_FALSE mpos
  LOAD_LOCAL 1
  PUSH_INT 1
  ADD
  RET
mpos:
  LOAD_LOCAL 1
  PUSH_INT 0
  EQ
  JMP_IF_FALSE both
  CLOSURE ack
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  PUSH_INT 1
  CALL 2
  RET
both:
  CLOSURE ack
  LOAD_LOCAL 0
  PUSH_INT 1
  SUB
  CLOSURE ack
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  PUSH_INT 1
  SUB
  CALL 2
  CALL 2
  RET
.end
