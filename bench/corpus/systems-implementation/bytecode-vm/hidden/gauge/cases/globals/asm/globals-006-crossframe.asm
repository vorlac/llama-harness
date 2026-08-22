; case globals-006-crossframe
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL counter
  CLOSURE bump
  CALL 0
  POP
  CLOSURE bump
  CALL 0
  POP
  LOAD_GLOBAL counter
  PRINT
  RET
.end
.func bump arity=0 locals=0
  LOAD_GLOBAL counter
  PUSH_INT 1
  ADD
  STORE_GLOBAL counter
  PUSH_NIL
  RET
.end
