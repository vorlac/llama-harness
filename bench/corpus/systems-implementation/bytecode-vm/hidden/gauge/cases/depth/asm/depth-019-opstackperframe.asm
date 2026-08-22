; case depth-019-opstackperframe
; expect exit=0 stdout="6\n1\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  CLOSURE f
  CALL 0
  PRINT
  POP
  POP
  PRINT
  RET
.end
.func f arity=0 locals=0
  PUSH_INT 4
  PUSH_INT 5
  PUSH_INT 6
  RET
.end
