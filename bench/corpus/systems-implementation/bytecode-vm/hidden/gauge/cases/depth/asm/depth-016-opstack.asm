; case depth-016-opstack
; expect exit=5 stdout=""
; expect error=E_STACK_OVERFLOW
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  PUSH_INT 4
  PUSH_INT 5
  PUSH_INT 6
  PUSH_INT 7
  PUSH_INT 8
  PUSH_INT 9
  PUSH_INT 10
  PUSH_INT 11
  PUSH_INT 12
  PUSH_INT 13
  PUSH_INT 14
  PUSH_INT 15
  PUSH_INT 16
  PUSH_INT 17
  PRINT
  RET
.end
