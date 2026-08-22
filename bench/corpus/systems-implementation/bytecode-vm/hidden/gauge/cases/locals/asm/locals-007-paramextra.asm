; case locals-007-paramextra
; expect exit=0 stdout="5\nnil\n0\n"
.func main arity=0 locals=0
  CLOSURE one
  PUSH_INT 5
  CALL 1
  PRINT
  RET
.end
.func one arity=1 locals=4
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 3
  PRINT
  PUSH_INT 0
  RET
.end
