; case strops-043-indexof
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR "mississippi"
  PUSH_STR "issi"
  INDEXOF
  PRINT
  RET
.end
